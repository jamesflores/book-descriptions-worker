export default {
	async fetch(request, env) {
	  try {
		const url = new URL(request.url);
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