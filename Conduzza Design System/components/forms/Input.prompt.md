Single-line field. Labels are sentence case in pt-BR; hints explain, they don't scold.

```jsx
<Input label="Nome do paciente" placeholder="Ex.: Mariana Alves" icon="user" />
<Input label="Duração" suffix="min" defaultValue="30" size="sm" />
<Input label="WhatsApp" error="Número inválido" defaultValue="(11) 9" />
```

Focus paints the border lime and adds `--focus-ring`. Never use placeholder text as the label.