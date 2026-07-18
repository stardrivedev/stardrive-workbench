export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
}

/** All galleries, keyed by slug. */
export type Galleries = Record<string, GalleryImage[]>;
