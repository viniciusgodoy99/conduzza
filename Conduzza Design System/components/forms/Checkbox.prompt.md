Multi-select and settings opt-ins. Also carries the `indeterminate` state for "select all" table headers.

```jsx
<Checkbox checked={all} indeterminate={some} onChange={setAll} />
<Checkbox checked label="Enviar 24h antes" description="Dispara às 09:00 do dia anterior" onChange={()=>{}} />
```

For a single on/off setting use `Switch` — checkbox is for lists, switch is for behaviour.