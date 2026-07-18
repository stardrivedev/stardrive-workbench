export interface Article {
  id: string;
  title: string;
  subtitle: string;
  date: string; // ISO date "YYYY-MM-DD"
  body: string; // markdown
  tags: string[];
  image?: string;
  author?: string;
}
