Menu attached to a trigger: filter pickers, row overflow actions, status changes.

```jsx
<Dropdown align="right" trigger={<IconButton icon="ellipsis" label="Ações" />} items={[
  {label:"Ver paciente",icon:"user"},
  {label:"Transferir atendimento",icon:"arrow-right-left"},
  {divider:true},
  {label:"Encerrar conversa",icon:"x",danger:true},
]} />
```

Items accept `checked` for multi-select filters and `shortcut` for keyboard hints. Closes on outside click.