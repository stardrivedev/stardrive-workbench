export interface Job {
  id: string;
  title: string;
  type: "Full-Time" | "Part-Time" | "Contract" | "Internship";
  location: string;
  description: string;
  requirements: string[];
  postedAt: string; // ISO date "YYYY-MM-DD"
}

export interface Application {
  id: string;
  jobId: string;
  jobTitle: string;
  name: string;
  email: string;
  message: string;
  receivedAt: string; // ISO datetime
}
