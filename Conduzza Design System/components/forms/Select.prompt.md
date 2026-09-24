Native select in the Conduzza control shell — used for every fixed-option picker (profissional, unidade, convênio, período).

```jsx
<Select label="Profissional" options={["Dra. Helena Reis","Dr. Caio Prado"]} />
<Select size="sm" options={[{value:"7d",label:"Últimos 7 dias"},{value:"30d",label:"Últimos 30 dias"}]} />
```

For free-text-plus-options use `Input`; for two or three views use `SegmentedControl`.