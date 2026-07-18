export interface ProductSpec {
  label: string;
  value: string;
}

export interface Product {
  id: string;
  title: string;
  category: string; // CatalogCategory id
  description: string;
  image?: string;
  specs: ProductSpec[];
  partNumber?: string;
  link?: string;
}

export interface CatalogCategory {
  id: string;
  label: string;
  description?: string;
}
