In-page sections when there are five or more views — Cadastro and Configurações both use it.

```jsx
<Tabs value={tab} onChange={setTab} items={[
  {value:"profissionais",label:"Profissionais",count:14},
  {value:"procedimentos",label:"Procedimentos",count:62},
  {value:"convenios",label:"Planos de saúde"},
]} />
```

Two-to-four views → `SegmentedControl` instead.