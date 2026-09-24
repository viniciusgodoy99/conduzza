The single button primitive — every clickable action in Conduzza Chat is one of its six variants.

```jsx
<Button variant="primary" icon="send">Enviar mensagem</Button>
<Button variant="secondary" iconRight="chevron-down">Todos os status</Button>
<Button variant="ghost" size="sm" icon="filter">Filtros</Button>
```

Rules: exactly **one** `primary` (lime) button per screen — it is the committing action. `solid` (inky) is for dark surfaces and confirm-destructive dialogs, `soft` for secondary lime affordances, `danger` only for irreversible actions. Sizes `sm` (dense toolbars), `md` (default), `lg` (empty states, auth, modals footers).
