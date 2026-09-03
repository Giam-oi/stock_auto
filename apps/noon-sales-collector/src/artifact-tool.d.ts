declare module "@oai/artifact-tool" {
  interface RangeFormat {
    numberFormat: string;
  }

  interface Range {
    values: Array<Array<string | number | boolean | null>>;
    format: RangeFormat;
  }

  interface Worksheet {
    getRangeByIndexes(startRow: number, startColumn: number, rowCount: number, columnCount: number): Range;
    getUsedRange(valuesOnly?: boolean): Range | undefined;
  }

  interface WorksheetCollection {
    add(name: string): Worksheet;
    getItemAt(index: number): Worksheet;
  }

  interface WorkbookInstance {
    worksheets: WorksheetCollection;
  }

  export const Workbook: {
    create(): WorkbookInstance;
  };

  interface FileBlob {
    save(path: string): Promise<void>;
  }

  export const FileBlob: {
    load(path: string): Promise<FileBlob>;
  };

  export const SpreadsheetFile: {
    exportXlsx(workbook: WorkbookInstance): Promise<FileBlob>;
    importXlsx(file: FileBlob): Promise<WorkbookInstance>;
  };
}
