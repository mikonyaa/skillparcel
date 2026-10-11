export interface EvidenceEvent {
  sequence: number;
  stage: string;
  elapsedMs: number;
  requestOrdinal?: number;
  toolUseId?: string;
  detail?: string;
}
export class Events {
  private started = performance.now();
  events: EvidenceEvent[] = [];
  add(
    stage: string,
    extra: Omit<EvidenceEvent, "sequence" | "stage" | "elapsedMs"> = {},
  ) {
    if (this.events.length >= 100)
      throw new Error("Evidence event budget exceeded");
    this.events.push({
      sequence: this.events.length + 1,
      stage,
      elapsedMs: Math.round(performance.now() - this.started),
      ...extra,
    });
  }
}
