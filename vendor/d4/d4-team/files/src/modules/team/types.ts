export interface TeamMember {
  id: string;
  name: string;
  /** Job title. The one field visitors actually scan for. */
  role: string;
  /** Short biography. Plain text; line breaks are preserved on the page. */
  bio?: string;
  photo?: string;
  email?: string;
  phone?: string;
  /** Profile links (LinkedIn, a professional register, a personal site). */
  links?: { label: string; href: string }[];
}
