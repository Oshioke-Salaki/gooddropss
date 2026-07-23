// Pure, dependency-free normalization of the drop webhook payload — extracted so
// it can be unit-tested without spinning up the route. Goldsky can deliver in two
// shapes; both collapse to { created, claimed, fields }.
//
//   • Mirror / entity webhook: { op:"INSERT"|"UPDATE", entity, data:{ new, old } }
//   • Generic event webhook:   { type|event, data|payload:{…fields} }

export type WebhookFields = Record<string, unknown>;

export interface NormalizedWebhook {
  created: boolean;
  claimed: boolean;
  fields:  WebhookFields;
}

export function normalizeWebhook(body: Record<string, unknown> | null | undefined): NormalizedWebhook {
  const b = body ?? {};
  const data = b.data as { new?: WebhookFields; old?: WebhookFields } | undefined;

  // Goldsky Mirror (entity row diff).
  if (typeof b.op === "string" && data && ("new" in data || "old" in data)) {
    const op  = String(b.op).toUpperCase();
    const nu  = (data.new ?? {}) as WebhookFields;
    const old = (data.old ?? null) as WebhookFields | null;
    const newStatus = Number(nu.status ?? -1);
    const oldStatus = old ? Number(old.status ?? -1) : -1;
    return {
      created: op === "INSERT",
      // A drop becomes Claimed (status 1) on a later UPDATE.
      claimed: (op === "UPDATE" || op === "INSERT") && newStatus === 1 && oldStatus !== 1,
      fields:  nu,
    };
  }

  // Generic event webhook.
  const type = String(b.type ?? b.event ?? "");
  const gen  = (b.data ?? b.payload ?? {}) as WebhookFields;
  const status = Number(gen.status ?? -1);
  return {
    created: type.includes("DropCreated"),
    claimed: type.includes("DropClaimed") || status === 1,
    fields:  gen,
  };
}

// Read a field from the normalised row, tolerating a nested `fields` wrapper.
export function readField(fields: WebhookFields, key: string): unknown {
  const nested = (fields.fields ?? {}) as WebhookFields;
  return fields[key] ?? nested[key];
}
