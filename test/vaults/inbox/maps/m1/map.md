---
type: map
map: m1
status: approved
awaiting: null
---
## Destination

- A fixture map for the inbox plugin's end-to-end tests.

## Concerns

```base
filters:
  and:
    - 'type == "concern"'
    - 'map == this.map'
views:
  - type: table
    name: Concerns
    order:
      - order
      - concern
      - outcome
      - after
      - stage
```

## Decisions so far

- The fixture map holds two concerns, and only c1 has documents.
