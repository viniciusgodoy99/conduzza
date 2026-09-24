Dialogs: new appointment, confirm cancellation, edit automation. Scrim is inky at 42% with a 3px blur.

```jsx
<Modal title="Cancelar consulta?" description="O paciente recebe um aviso no WhatsApp." width={420}
  onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Voltar</Button><Button variant="solid">Cancelar consulta</Button></>}>
  …
</Modal>
```