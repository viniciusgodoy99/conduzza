A booking on the Agenda grid. Status drives the 3px left bar and the tint.

```jsx
<AppointmentCard start="09:30" end="10:00" patient="Mariana Alves" procedure="Retorno · Dermatologia" status="confirmado" professional="Dra. Helena" room="Sala 2" />
<AppointmentCard compact start="10:15" patient="Encaixe — Paulo N." status="encaixe" />
```

Statuses: confirmado, aguardando, cancelado, encaixe, bloqueio. Use `compact` for slots under 20 minutes.