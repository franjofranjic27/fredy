export interface ConfluencePage {
  id: string;
  type: string;
  status: string;
  title: string;
  space: {
    key: string;
    name: string;
  };
  body: {
    storage: {
      value: string;
      representation: string;
    };
  };
  version: {
    number: number;
    when: string;
    by: {
      displayName: string;
      email?: string;
    };
  };
  ancestors: Array<{
    id: string;
    title: string;
  }>;
  metadata: {
    labels: {
      results: Array<{
        name: string;
        prefix: string;
      }>;
    };
  };
  _links: {
    webui: string;
    self: string;
  };
}

export interface ConfluenceSearchResult {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
  _links: {
    next?: string;
  };
}

export interface PageMetadata {
  pageId: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  labels: string[];
  author: string;
  lastModified: string;
  version: number;
  url: string;
  ancestors: string[]; // Breadcrumb path
}
