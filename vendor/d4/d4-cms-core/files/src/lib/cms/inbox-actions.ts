"use server";

import { assertAuthenticated } from "@/lib/cms/auth";
import { readCollection } from "@/lib/cms/data-store";

/**
 * Read-only inbox over collections other modules write: contact messages
 * (site template) and job applications (careers module, when installed).
 * Shapes are read loosely from the store; missing collections read as [].
 */
export interface InboxMessage {
  name: string;
  email: string;
  message: string;
  receivedAt: string;
}

export interface InboxApplication {
  id: string;
  jobId: string;
  jobTitle: string;
  name: string;
  email: string;
  message: string;
  receivedAt: string;
}

export async function getInboxAction(): Promise<{
  messages: InboxMessage[];
  applications: InboxApplication[];
  error?: string;
}> {
  try {
    await assertAuthenticated();
    const [messages, applications] = await Promise.all([
      readCollection<InboxMessage[]>("messages", []),
      readCollection<InboxApplication[]>("applications", []),
    ]);
    const newestFirst = (a: { receivedAt: string }, b: { receivedAt: string }) =>
      (b.receivedAt || "").localeCompare(a.receivedAt || "");
    return {
      messages: [...messages].sort(newestFirst),
      applications: [...applications].sort(newestFirst),
    };
  } catch (e) {
    return { messages: [], applications: [], error: String(e) };
  }
}
