# Book Descriptions Worker

A Cloudflare Worker that handles book description retrieval and caching. The worker fetches book descriptions from the Google Books API and caches them in a D1 database for improved performance.

## Features

- Fetches book descriptions from Google Books API
- Caches descriptions in Cloudflare D1 database
- Case-insensitive search and caching
- English language descriptions only
- Error handling and logging
- Browser-side caching headers
- Fallback for missing descriptions

## Setup

1. Clone the repository:
```bash
git clone [repository-url]
cd book-descriptions-worker
```

2. Install dependencies:
```bash
npm install
```

3. Copy the example configuration:
```bash
cp wrangler.example.toml wrangler.toml
```

4. Create a D1 database:
```bash
wrangler d1 create book-descriptions
```

5. Update your `wrangler.toml` with the database ID from the previous step.

6. Create the database tables:
```bash
wrangler d1 execute book-descriptions --file=../migrations/schema.sql --remote
```

7. Add your Google Books API key (https://developers.google.com/books/docs/v1/using):
```bash
wrangler secret put GOOGLE_BOOKS_API_KEY
```

## Creating a New Worker

If you want to create a new worker project using this code:

1. Create a new directory and initialize a worker:
```bash
# Create new directory
mkdir my-book-descriptions
cd my-book-descriptions

# Initialize a new worker project
npm create cloudflare@latest

# Select these options:
# - Type: "Worker"
# - Framework: "None"
# - TypeScript: No (or Yes if you prefer)
# - Package manager: npm
```

2. Copy the source files from this repository:
```bash
# Create directories
mkdir -p src migrations

# Copy files
cp path/to/this/repo/src/index.js src/
cp path/to/this/repo/migrations/schema.sql migrations/
cp path/to/this/repo/wrangler.example.toml ./
```

3. Follow the standard setup steps above, starting from step 3 (copying wrangler.example.toml).

4. Your directory structure should look like:
```
my-book-descriptions/
├── node_modules/
├── migrations/
│   └── schema.sql
├── src/
│   └── index.js
├── package.json
├── wrangler.toml
└── wrangler.example.toml
```

Now continue with the deployment steps as normal.

## Deployment

Deploy to Cloudflare Workers:
```bash
wrangler deploy
```

## Custom Domain Setup (optional)

1. In Cloudflare dashboard, add DNS record:
   - Type: CNAME
   - Name: custom
   - Target: [your-worker].workers.dev
   - Proxy status: Proxied

2. Add custom domain in Workers settings or add to wrangler.toml:
```toml
routes = [
  { pattern = "custom.domain.com", custom_domain = true }
]
```

## Usage

The worker accepts GET requests with two query parameters:

```
https://custom.domain.com/?book_title=Book%20Title&author_name=Author%20Name
```

### Parameters

| Parameter | Description | Required |
|-----------|-------------|----------|
| book_title | Title of the book | Yes |
| author_name | Name of the author | Yes |

### Response Format

Success:
```json
{
  "description": "Book description text",
  "source": "cache|google"
}
```

Error:
```json
{
  "error": "Error message",
  "details": "Additional error details"
}
```

## Development

Run locally:
```bash
wrangler dev
```

View logs:
```bash
wrangler tail
```

## Database Management

List cached descriptions:
```bash
wrangler d1 execute book-descriptions --command="SELECT * FROM book_descriptions LIMIT 10;"
```

Clear cache:
```bash
wrangler d1 execute book-descriptions --command="DELETE FROM book_descriptions;"
```

## Error Handling

The worker includes several layers of error handling:
1. D1 database errors
2. Google Books API errors
3. Rate limiting responses
4. Invalid input handling

## Caching Strategy

1. D1 Database Cache:
   - Permanent storage of descriptions
   - Case-insensitive lookups
   - Stores "No description available" for missing descriptions

2. WordPress Transient Cache:
   - 12-hour cache in WordPress
   - Reduces calls to worker

3. Browser Cache:
   - Cache-Control headers set for efficient browser caching

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License

## Credits

- Google Books API for book descriptions
- Cloudflare Workers and D1 for hosting and storage

## Contact

Email: james@jamesflores.net