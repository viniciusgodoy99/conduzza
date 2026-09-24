The permanent left rail — always dark ink, always present. Lime tints the current page; counts ride on the right.

```jsx
<SidebarNav active="atendimento" onNavigate={setPage}
  brand={<img src="assets/logo-lockup-on-dark.png" alt="Conduzza" style={{height:22}} />}
  items={[
    {id:"inicio",label:"Início",icon:"house"},
    {id:"atendimento",label:"Atendimento",icon:"messages-square",count:12},
    {section:"Gestão"},
    {id:"leads",label:"Leads",icon:"user-plus",count:38},
  ]}
  footer={<UserChip/>} />
```

Pass `{section:"…"}` to start a group. `collapsed` narrows it to 64px icons.