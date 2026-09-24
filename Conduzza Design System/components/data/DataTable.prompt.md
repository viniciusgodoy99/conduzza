Every record list: Pacientes, Leads (lista), Confirmações, Lista de espera. Hairline rows, no vertical rules, sticky uppercase header.

```jsx
<Card padding={0}>
  <DataTable selectable selected={sel} onSelect={toggle} rows={pacientes} columns={[
    {key:"nome",header:"Paciente",strong:true,render:r=><PatientCell row={r}/>},
    {key:"telefone",header:"WhatsApp",numeric:true},
    {key:"status",header:"Status",render:r=><Badge tone="success" dot>Ativo</Badge>},
    {key:"ultima",header:"Última consulta",numeric:true,align:"right",muted:true},
  ]}/>
</Card>
```

Mark every figure, date and phone column `numeric` so it renders mono + tabular. Wrap in `<Card padding={0}>`.