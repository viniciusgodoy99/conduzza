The *etiqueta* — a label the clinic's team assigns to a conversation, lead or patient. Colour is data, so it is passed in, not chosen from a tone scale.

```jsx
<Tag color="#b2e54f">Primeira consulta</Tag>
<Tag color="#4785b5" onRemove={() => {}}>Convênio</Tag>
```

Use `Badge` for system-owned status instead. Tags are square-cornered (`--radius-xs`) on purpose — that distinguishes them from status pills at a glance.
