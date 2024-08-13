# esperf

> A command-line utility for detecting and fixing performance problems in
> JavaScript projects.

## Work in progress

This project is very much a work in progress right now. Consider it unstable
until we remove this notice.

## Install

```sh
npm i -S esperf

# or
npx esperf
```

## Usage

The interactive CLI can guide you through the following steps:

- Detecting replaceable modules
- Applying the replacements automatically

```sh
npx esperf
```

### Flags

#### parallelism

Amount of threads to use.

```
npx esperf --parallelism 4
```

## License

MIT
