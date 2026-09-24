The message box: AI suggestion strip, quick-reply chips, textarea, attachment tools, lime round send.

```jsx
<Composer value={draft} onChange={setDraft} onSend={send}
  aiSuggestion="Posso oferecer quinta 10:30 ou 15:00?"
  quickReplies={["Bom dia! 👋","Confirmar presença","Enviar endereço","Valores"]} />
```

Enter sends, Shift+Enter breaks the line.