/**
 * GENERATED FILE. The site's finished copy, written by Stardrive from the
 * owner's intake answers. Templates render every page body from `siteContent`
 * (with graceful fallbacks); empty sections hide. Do not edit; overwritten.
 */
export interface SiteContent {
  tagline: string;
  description: string;
  home: { heroHeadline: string; heroSubhead: string; ctaLabel: string; introHeading: string; introBody: string };
  about: { heading: string; paragraphs: string[]; mission: string };
  services: { name: string; description: string }[];
  contact: { heading: string; intro: string };
  faq: { question: string; answer: string }[];
  team: { name: string; role: string; bio: string }[];
  careers: { heading: string; intro: string; roles: { title: string; summary: string }[] } | null;
  store: { heading: string; intro: string; products: { name: string; price: string; description: string }[] } | null;
  blog: { heading: string; intro: string; posts: { title: string; excerpt: string; body: string }[] } | null;
}

export const siteContent: SiteContent = {
  "tagline": "",
  "description": "",
  "home": {
    "heroHeadline": "",
    "heroSubhead": "",
    "ctaLabel": "",
    "introHeading": "",
    "introBody": ""
  },
  "about": {
    "heading": "",
    "paragraphs": [],
    "mission": ""
  },
  "services": [],
  "contact": {
    "heading": "",
    "intro": ""
  },
  "faq": [],
  "team": [],
  "careers": null,
  "store": null,
  "blog": null
};
