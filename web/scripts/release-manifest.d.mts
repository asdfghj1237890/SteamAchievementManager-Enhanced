export declare function stripOneTrailingNewline(s: string): string

export declare function signedVersion(sig: string): string | undefined

export interface BuildLatestJsonArgs {
  version: string
  pubDate: string
  notes: string
  winUrl: string
  winSig: string
  macUrl: string
  macSig: string
}

export interface LatestJson {
  version: string
  pub_date: string
  notes: string
  platforms: {
    'windows-x86_64': { url: string; signature: string }
    'darwin-aarch64': { url: string; signature: string }
  }
}

export declare function buildLatestJson(args: BuildLatestJsonArgs): LatestJson

export declare function formatLatestJson(obj: unknown): string

export declare function formatPubDate(date?: Date): string

export declare function compareVersions(a: string, b: string): number

export declare function shouldWriteVersion(newV: string, curV: string): boolean
