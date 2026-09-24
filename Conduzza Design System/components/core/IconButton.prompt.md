Square icon-only button for toolbars, message composers and table row actions — always give it a `label` for screen readers.

```jsx
<IconButton icon="filter" label="Filtrar" />
<IconButton icon="trash-2" label="Excluir" variant="danger" size="sm" />
```

Variants match `Button` (`primary`, `solid`, `secondary`, `ghost`, `soft`, `danger`); `ghost` is the default inside dense chrome. Set `round` for the circular treatment used in the chat composer.
