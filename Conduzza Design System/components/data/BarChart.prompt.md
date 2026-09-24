The kit's only bar series — pure CSS, no charting library. Lime bars, ink for the highlighted period.

```jsx
<BarChart height={150} data={[{label:"Seg",value:34},{label:"Ter",value:41},{label:"Hoje",value:52,highlight:true}]} />
```

Keep series under ~14 bars; beyond that switch to a table.