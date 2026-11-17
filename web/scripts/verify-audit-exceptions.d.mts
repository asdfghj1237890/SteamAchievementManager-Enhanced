export declare const SUPPORTED_TARGETS: string[]
export declare const MANIFESTS: string[]
export declare const EXCLUDED_CRATES: string[]
interface CargoResult {
  status: number | null
  stdout: string
  stderr?: string
  error?: Error
  signal?: string | null
}
type RunCargo = (command: string, args: string[], options: { encoding: string; maxBuffer: number }) => CargoResult
export declare function verifyAuditExceptions(runCargo?: RunCargo): void
