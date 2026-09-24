Multi-line field for message templates, internal notes and AI instructions.

```jsx
<Textarea label="Mensagem de confirmação" rows={5} counter={320} value={v} onChange={e=>set(e.target.value)} />
```

Pass `counter` whenever the text ends up in a WhatsApp message — length matters there.