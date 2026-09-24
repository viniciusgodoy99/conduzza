Every panel in the product is a Card. White, `--radius-card` (16px), one hairline border, one low shadow — never two elevation cues at once.

```jsx
<Card header="Confirmações de hoje" actions={<IconButton icon="ellipsis" label="Opções" />}>
  …
</Card>
<Card tone="inverse" padding={20}>…</Card>
```

`padding={0}` when the card wraps a `DataTable`. `tone="inverse"` flips the card into the dark scope (it applies `.cz-dark`, so tokens inside resolve automatically).
