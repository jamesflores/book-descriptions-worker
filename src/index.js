export default {
	async fetch(request, env) {
	  try {
		// Maybe trigger cleanup
		if (shouldRunCleanup(env)) {
		  console.log('Triggering cleanup of old descriptions');
		  // Don't await to avoid delaying the response
		  cleanupOldDescriptions(env.DB, env.DESCRIPTION_RETENTION_DAYS || 30)
			.catch(error => console.error('Cleanup error:', error));
		}
  
		const url = new URL(request.url);
  
		// Handle status endpoint
		if (url.pathname === '/status') {
		  const stats = await getSystemStatus(env.DB, env);
		  return new Response(JSON.stringify(stats, null, 2), {
			headers: { 'Content-Type': 'application/json' }
		  });
		}
  
		// Handle cleanup endpoint
		if (url.pathname === '/cleanup') {
		  const cleaned = await cleanupOldDescriptions(env.DB, env.DESCRIPTION_RETENTION_DAYS || 30);
		  return new Response(JSON.stringify({
			message: 'Cleanup completed',
			deletedCount: cleaned
		  }), {
			headers: { 'Content-Type': 'application/json' }
		  });
		}
  
		let bookTitle = url.searchParams.get('book_title');
		let authorName = url.searchParams.get('author_name');
  
		if (!bookTitle || !authorName) {
		  return new Response('Missing book_title or author_name parameters', {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		  });
		}
  
		// Normalize the strings by trimming and converting to a consistent case
		bookTitle = bookTitle.trim();
		authorName = authorName.trim();
  
		console.log(`Fetching description for "${bookTitle}" by ${authorName}`);
  
		// Check D1 cache first
		const cached = await checkCache(env.DB, bookTitle, authorName);
		if (cached) {
		  console.log('Description found in cache');
		  return new Response(JSON.stringify({
			description: cached.description,
			source: 'cache'
		  }), {
			headers: {
			  'Content-Type': 'application/json',
			  'Cache-Control': 'public, max-age=31536000, immutable'
			}
		  });
		}
  
		console.log('Description not in cache, fetching from Google Books API');
		const description = await fetchGoogleBooksDescription(bookTitle, authorName, env);
		
		if (description) {
		  // Store in D1
		  await cacheDescription(env.DB, bookTitle, authorName, description);
		  
		  return new Response(JSON.stringify({
			description: description,
			source: 'google'
		  }), {
			headers: {
			  'Content-Type': 'application/json',
			  'Cache-Control': 'public, max-age=31536000, immutable'
			}
		  });
		}
  
		// Cache the fact that no description was found
		const noDescription = 'No description available';
		await cacheDescription(env.DB, bookTitle, authorName, noDescription);
		
		return new Response(JSON.stringify({
		  description: noDescription,
		  source: 'google'
		}), {
		  status: 200,
		  headers: { 'Content-Type': 'application/json' }
		});
  
	  } catch (error) {
		console.error('Error:', error);
		return new Response(JSON.stringify({
		  error: 'Failed to fetch book description',
		  details: error.message
		}), {
		  status: 500,
		  headers: { 'Content-Type': 'application/json' }
		});
	  }
	}
  };
  
  function shouldRunCleanup(env) {
	const probability = parseInt(env.CLEANUP_PROBABILITY || '5', 10);
	return Math.random() * 100 < probability;
  }
  
  async function getSystemStatus(db, env) {
	const queries = {
	  totalDescriptions: `
		SELECT COUNT(*) as count 
		FROM book_descriptions
	  `,
	  storageUsage: `
		SELECT 
		  COUNT(*) as total_entries,
		  SUM(LENGTH(description)) as description_bytes,
		  SUM(LENGTH(book_title)) as title_bytes,
		  SUM(LENGTH(author_name)) as author_bytes,
		  SUM(LENGTH(description) + LENGTH(book_title) + LENGTH(author_name)) as total_bytes
		FROM book_descriptions
	  `,
	  oldestNewest: `
		SELECT 
		  MIN(created_at) as oldest_entry,
		  MAX(created_at) as newest_entry
		FROM book_descriptions
	  `,
	  ageDistribution: `
		SELECT 
		  CASE 
			WHEN julianday('now') - julianday(created_at) < 1 THEN 'last_24h'
			WHEN julianday('now') - julianday(created_at) < 7 THEN 'last_7d'
			WHEN julianday('now') - julianday(created_at) < 30 THEN 'last_30d'
			ELSE 'older'
		  END as age,
		  COUNT(*) as count
		FROM book_descriptions
		GROUP BY age
	  `,
	  noDescriptionCount: `
		SELECT COUNT(*) as count
		FROM book_descriptions
		WHERE description = 'No description available'
	  `,
	  averageDescriptionLength: `
		SELECT AVG(LENGTH(description)) as avg_length
		FROM book_descriptions
		WHERE description != 'No description available'
	  `
	};
  
	const results = {};
	
	// Execute all queries
	for (const [key, query] of Object.entries(queries)) {
	  results[key] = await db.prepare(query).all();
	}
  
	// Format the results into a nice status object
	const status = {
	  database: {
		total_entries: results.storageUsage.results[0].total_entries,
		storage: {
		  descriptions_mb: (results.storageUsage.results[0].description_bytes / (1024 * 1024)).toFixed(2),
		  titles_mb: (results.storageUsage.results[0].title_bytes / (1024 * 1024)).toFixed(2),
		  authors_mb: (results.storageUsage.results[0].author_bytes / (1024 * 1024)).toFixed(2),
		  total_mb: (results.storageUsage.results[0].total_bytes / (1024 * 1024)).toFixed(2)
		},
		timestamps: {
		  oldest_entry: results.oldestNewest.results[0].oldest_entry,
		  newest_entry: results.oldestNewest.results[0].newest_entry
		}
	  },
	  entries: {
		total: results.totalDescriptions.results[0].count,
		no_description_count: results.noDescriptionCount.results[0].count,
		average_description_length: Math.round(results.averageDescriptionLength.results[0].avg_length)
	  },
	  age_distribution: results.ageDistribution.results.reduce((acc, item) => {
		acc[item.age] = item.count;
		return acc;
	  }, {}),
	  configuration: {
		retention_days: parseInt(env.DESCRIPTION_RETENTION_DAYS || '30'),
		cleanup_probability: parseInt(env.CLEANUP_PROBABILITY || '5')
	  },
	  cleanup_estimation: {
		entries_older_than_retention: results.ageDistribution.results
		  .find(r => r.age === 'older')?.count || 0
	  }
	};
  
	return status;
  }
  
  async function cleanupOldDescriptions(db, retentionDays) {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
	const cutoffDateStr = cutoffDate.toISOString();
  
	const result = await db.prepare(
	  'DELETE FROM book_descriptions WHERE created_at < ? RETURNING id'
	).bind(cutoffDateStr).all();
  
	const deletedCount = result?.results?.length || 0;
	console.log(`Cleaned up ${deletedCount} old descriptions`);
	return deletedCount;
  }
  
  async function checkCache(db, bookTitle, authorName) {
	const result = await db.prepare(
	  'SELECT description FROM book_descriptions WHERE book_title = ? COLLATE NOCASE AND author_name = ? COLLATE NOCASE LIMIT 1'
	).bind(bookTitle, authorName).first();
	return result;
  }
  
  async function cacheDescription(db, bookTitle, authorName, description) {
	try {
	  await db.prepare(
		'INSERT INTO book_descriptions (book_title, author_name, description, created_at) VALUES (?, ?, ?, ?)'
	  ).bind(
		bookTitle,
		authorName,
		description,
		new Date().toISOString()
	  ).run();
	} catch (error) {
	  // If the error is due to a unique constraint violation, try to update instead
	  if (error.message.includes('UNIQUE constraint failed')) {
		await db.prepare(
		  'UPDATE book_descriptions SET description = ?, created_at = ? WHERE book_title = ? COLLATE NOCASE AND author_name = ? COLLATE NOCASE'
		).bind(
		  description,
		  new Date().toISOString(),
		  bookTitle,
		  authorName
		).run();
	  } else {
		throw error;
	  }
	}
  }
  
  async function fetchGoogleBooksDescription(bookTitle, authorName, env) {
	const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(bookTitle + ' inauthor:' + authorName)}&langRestrict=en&key=${env.GOOGLE_BOOKS_API_KEY}`;
	console.log('Fetching from URL:', url);
	
	const response = await fetch(url);
	console.log('Google Books API response status:', response.status);
	
	if (!response.ok) {
	  if (response.status === 429) {
		throw new Error('Rate limit exceeded. Please try again later.');
	  }
	  console.error('Google Books API error response:', await response.text());
	  throw new Error(`Failed to fetch from Google Books API: ${response.status}`);
	}
  
	const data = await response.json();
	console.log('Found', data.items?.length || 0, 'results');
	
	// Look for the first item with an English description
	let description = null;
	if (data.items) {
	  for (const item of data.items) {
		const desc = item?.volumeInfo?.description;
		// Simple check to see if the description appears to be English
		// This is a basic check - could be enhanced with more sophisticated language detection
		if (desc && isLikelyEnglish(desc)) {
		  description = desc;
		  break;
		}
	  }
	}
	
	return description;
  }
  
  // Basic function to check if text is likely English
  function isLikelyEnglish(text) {
	// Common English words that would appear in book descriptions
	const englishWords = ['the', 'and', 'in', 'of', 'to', 'a', 'is', 'that', 'for', 'with'];
	const lowerText = text.toLowerCase();
	
	// Count how many common English words appear
	const matches = englishWords.filter(word => 
	  lowerText.includes(` ${word} `) || lowerText.startsWith(`${word} `) || lowerText.endsWith(` ${word}`)
	).length;
	
	// If more than 3 common English words are found, consider it English
	return matches > 3;
  }