// packages/connectors/types.ts
// Contrato público compartido por todos los conectores (patrón osiris route-normalization).
// Origen único: cada conector lo importa; el barrel lo re-exporta. (ponytail: dedup de 7 copias → 1)

export interface ConnectorResult<T> {
  data: T[];
  stale: boolean;
  fetchedAt: number;
}
