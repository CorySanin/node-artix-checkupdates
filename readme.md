# node-artix-checkupdates

node library to interface with [artix-checkupdates](https://packages.artixlinux.org/packages/world/x86_64/artix-checkupdates/).

## Usage

```
import { Checkupdates } from 'artix-checkupdates';

const check = new Checkupdates();

console.log(await check.fetchUpgradable());
```
