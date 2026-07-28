export interface Subscriber {
  id: string;
  email: string;
  name?: string;
  /** ISO datetime. */
  subscribedAt: string;
  /** Set when they leave. Kept rather than deleted, so a later re-import
   *  cannot quietly resurrect someone who asked to be removed. */
  unsubscribedAt?: string;
  /** The page the form was on, so the owner knows what they signed up from. */
  source?: string;
  /** The exact wording they agreed to. Consent you cannot evidence is not
   *  consent, and this is the field that evidences it. */
  consentText?: string;
  /** Random, unguessable, used for their unsubscribe link. */
  token: string;
}

export const DEFAULT_CONSENT =
  "Yes, email me occasional updates. I can unsubscribe at any time.";
