export interface AuditAdvisory {
  name?: string
  severity?: string
  title?: string
}

export interface AuditReport {
  auditReportVersion?: number
  vulnerabilities: Record<string, unknown>
  metadata?: { vulnerabilities?: { total?: number } }
}

export interface AuditEvaluation {
  ok: boolean
  found: Map<string, AuditAdvisory>
  blocking: string[]
  accepted: string[]
  stale: string[]
  unreadable: boolean
}

export declare function isAuditReport(report: unknown): report is AuditReport
export declare function evaluateAudit(report: AuditReport, allowed?: Map<string, string>): AuditEvaluation
