# ARCHIVED

This project was basically an early attempt at tooling to help fix performance problems in JavaScript/TypeScript code.

We have since implemented this in the [e18e ESLint plugin](https://github.com/e18e/eslint-plugin) and the [e18e web-features codemods](https://github.com/e18e/web-features-codemods) projects.

Similarly, the [e18e CLI](https://github.com/e18e/cli/) will also be capable of this one day.

These tools essentially replace what this one was intended to be. Please check those out instead!

---

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
