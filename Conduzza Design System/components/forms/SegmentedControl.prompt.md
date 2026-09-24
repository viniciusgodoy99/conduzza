Switches between two-to-four views of the same data — Kanban vs Lista, Dia/Semana/Mês, status filters in Confirmações.

```jsx
<SegmentedControl value={view} onChange={setView} options={[{value:"kanban",label:"Kanban",icon:"columns-3"},{value:"lista",label:"Lista",icon:"list"}]} />
```

Pass `count` on an option to show the number of records behind it. Five or more options → use `Tabs`.