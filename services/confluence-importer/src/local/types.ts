export interface LocalFile {
  filePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  content: string;
  modifiedAt: Date;
}
