Read-only status pill: confirmation states, connection health, plan tiers, counts.

```jsx
<Badge tone="success" dot>Confirmado</Badge>
<Badge tone="warning">Aguardando</Badge>
<Badge tone="danger" icon="x">Cancelado</Badge>
```

Tone mapping used across the product: `success` confirmado, `warning` aguardando/pendente, `danger` cancelado/faltou, `info` remarcado, `lime` novo/IA, `neutral` everything else. For user-assigned, colour-coded labels use `Tag` instead.
