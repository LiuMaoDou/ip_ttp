# TTP Web Frontend

Interactive React frontend for TTP (Template Text Parser).

## Features

- **Template Builder**: Select text, right-click to add variables with pattern matching
- **File Input**: Drag & drop file upload or paste text directly
- **Test & Results**: Parse data and view JSON results

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Technology Stack

- React 18 + TypeScript
- Vite
- Monaco Editor (VS Code core)
- Tailwind CSS
- Zustand (state management)
- react-dropzone
- react-json-view-lite

## Usage

1. Enter sample text in the Template Builder
2. Select text segments and right-click to add as variables
3. Choose a pattern type (IP, DIGIT, MAC, etc.)
4. Click "Generate Template" to create the TTP template
5. Upload input files in the File Input tab
6. Click "Run Test" in the Test & Results tab to parse

## API Configuration

The frontend expects the backend API at `/api`. In development, Vite proxies requests to `http://localhost:8000`.
