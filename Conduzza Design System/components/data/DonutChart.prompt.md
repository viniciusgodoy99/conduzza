Share-of-total ring for Resultados — origem dos leads, status das confirmações, canais.

```jsx
<DonutChart centerValue="147" centerLabel="consultas" segments={[
  {label:"Confirmadas",value:128,color:"var(--cz-lime-400)"},
  {label:"Aguardando",value:12,color:"var(--cz-warning-500)"},
  {label:"Canceladas",value:7,color:"var(--cz-danger-500)"},
]} />
```

Four segments maximum; anything smaller becomes "Outros".