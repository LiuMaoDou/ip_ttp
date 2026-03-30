import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TestResults from './TestResults'
import type { BatchParseJob, BatchParseResultsPage } from '../../services/api'
import { getBatchParseJob, getBatchParseResultsPage } from '../../services/api'

const { mockStoreState, mockUseStore } = vi.hoisted(() => {
  const state = {
    generatedTemplate: '',
    savedTemplates: [],
    isLoadingTemplates: false,
    isLoadingTemplateDirectories: false,
    vendors: [],
    parseCategories: [],
    templateName: '',
    inputText: '',
    batchUploads: [
      {
        id: 'upload-1',
        name: 'edge.txt',
        size: 42,
        isArchive: false,
        content: 'hostname edge-1',
      },
    ],
    setInputText: vi.fn(),
    addGenerationUploadedFile: vi.fn(),
    setActiveTab: vi.fn(),
    setBatchUploads: vi.fn(),
  }

  const useStoreMock = Object.assign(
    vi.fn(() => state),
    {
      getState: vi.fn(() => state),
    },
  )

  return {
    mockStoreState: state,
    mockUseStore: useStoreMock,
  }
})

vi.mock('../TemplateDirectoryTree', () => ({
  default: () => <div data-testid="template-tree" />,
}))

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false,
  }),
}))

vi.mock('../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../services/api')>('../../services/api')
  return {
    ...actual,
    getBatchParseJob: vi.fn(),
    getBatchParseResultsPage: vi.fn(),
  }
})

vi.mock('../../store/useStore', () => ({
  useStore: mockUseStore,
}))

type FakeRequest<T> = {
  result?: T
  error?: Error
  onupgradeneeded?: (() => void) | null
  onsuccess?: (() => void) | null
  onerror?: (() => void) | null
}

function createIndexedDbMock() {
  const store = new Map<string, unknown>()

  const createRequest = <T,>(resultFactory: () => T): FakeRequest<T> => {
    const request: FakeRequest<T> = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    }

    queueMicrotask(() => {
      try {
        request.result = resultFactory()
        request.onsuccess?.()
      } catch (error) {
        request.error = error instanceof Error ? error : new Error(String(error))
        request.onerror?.()
      }
    })

    return request
  }

  return {
    open: vi.fn(() => {
      const request: FakeRequest<IDBDatabase> = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      }

      queueMicrotask(() => {
        const database = {
          createObjectStore: vi.fn(),
          transaction: vi.fn(() => ({
            objectStore: vi.fn(() => ({
              get: (key: string) => createRequest(() => store.get(key)),
              put: (value: unknown, key: string) => createRequest(() => {
                store.set(key, value)
                return undefined
              }),
              delete: (key: string) => createRequest(() => {
                store.delete(key)
                return undefined
              }),
            })),
          })),
        } as unknown as IDBDatabase

        request.result = database
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })

      return request
    }),
  }
}

function createLocalStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key)
    }),
  }
}

describe('TestResults download menu', () => {
  const jobStorageKey = 'ttp-test-results-last-job-id'
  let storageMock: ReturnType<typeof createLocalStorageMock>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('indexedDB', createIndexedDbMock())
    storageMock = createLocalStorageMock()
    Object.defineProperty(window, 'localStorage', {
      value: storageMock,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      configurable: true,
    })
    storageMock.removeItem(jobStorageKey)
    mockStoreState.generatedTemplate = ''
    mockStoreState.savedTemplates = []
    mockStoreState.isLoadingTemplates = false
    mockStoreState.isLoadingTemplateDirectories = false
    mockStoreState.vendors = []
    mockStoreState.parseCategories = []
    mockStoreState.templateName = ''
    mockStoreState.inputText = ''
    mockStoreState.batchUploads = [
      {
        id: 'upload-1',
        name: 'edge.txt',
        size: 42,
        isArchive: false,
        content: 'hostname edge-1',
      },
    ]
  })

  afterEach(() => {
    storageMock.removeItem(jobStorageKey)
    vi.unstubAllGlobals()
  })

  it('shows the Excel artifact when the batch job exposes it', async () => {
    const batchJob: BatchParseJob = {
      id: 'job-1',
      status: 'completed',
      phaseMessage: 'Batch parse completed',
      createdAt: 1,
      updatedAt: 2,
      startedAt: 1,
      completedAt: 2,
      templateCount: 1,
      uploadCount: 1,
      scannedUploads: 1,
      totalUploads: 1,
      processedArchiveEntries: 0,
      totalArchiveEntries: 0,
      uploads: [{ name: 'edge.txt', size: 42, isArchive: false }],
      discoveredFileCount: 1,
      skippedFileCount: 0,
      totalTasks: 1,
      completedTasks: 1,
      successCount: 1,
      failureCount: 0,
      previewResults: [],
      recentError: null,
      artifactUrls: {
        summary: '/api/parse/batch/jobs/job-1/artifacts/summary',
        results: '/api/parse/batch/jobs/job-1/artifacts/results',
        errors: null,
        excel: '/api/parse/batch/jobs/job-1/artifacts/excel',
      },
    }

    const resultsPage: BatchParseResultsPage = {
      jobId: 'job-1',
      offset: 0,
      limit: 50,
      total: 0,
      items: [],
    }

    vi.mocked(getBatchParseJob).mockResolvedValue(batchJob)
    vi.mocked(getBatchParseResultsPage).mockResolvedValue(resultsPage)
    window.localStorage.setItem(jobStorageKey, 'job-1')

    render(<TestResults />)

    await waitFor(() => expect(getBatchParseJob).toHaveBeenCalledWith('job-1'))

    await userEvent.click(screen.getByRole('button', { name: /download/i }))

    const excelLink = await screen.findByRole('link', { name: 'Excel' })
    expect(excelLink).toHaveAttribute('href', '/api/parse/batch/jobs/job-1/artifacts/excel')
  })
})
