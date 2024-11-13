export interface Book {
  title: string;
  author: string;
  rating: number;
  dateRead: Date | null;
  review: string;
  bookshelves: string[];
}

export type SortBy = 'date' | 'rating';

export async function parseBooks(): Promise<Book[]> {
  const response = await import('/public/data/goodreads_library_export.csv?raw');
  const text = response.default;
  const lines = text.split('\n').slice(1);
  
  return lines
    .filter(line => line.trim())
    .map(line => {
      const [_, title, author, , , , , rating, , , , , , , dateRead, , bookshelves, , , review] = 
        line.split(',').map(field => field.replace(/^="(.*)"$/, '$1'));
      
      return {
        title,
        author,
        rating: parseInt(rating) || 0,
        dateRead: dateRead ? new Date(dateRead) : null,
        review: review || '',
        bookshelves: bookshelves?.split(';').map(s => s.trim()) || []
      };
    });
}

export function filterBooks(books: Book[], shelf?: string): Book[] {
  if (!shelf) return books;
  return books.filter(book => book.bookshelves.includes(shelf));
}

export function sortBooks(books: Book[], sortBy: SortBy = 'date'): Book[] {
  return [...books].sort((a, b) => {
    if (sortBy === 'date') {
      return (b.dateRead?.getTime() || 0) - (a.dateRead?.getTime() || 0);
    }
    return b.rating - a.rating;
  });
} 