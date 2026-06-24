'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');

const readPackageUp = async (startDirectory) => {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    const packagePath = path.join(currentDirectory, 'package.json');
    try {
      const content = await fs.readFile(packagePath, 'utf8');
      return {
        path: packagePath,
        pkg: JSON.parse(content)
      };
    } catch (error) {
      if (error && error.code !== 'ENOENT' && error instanceof SyntaxError === false) {
        throw error;
      }

      if (error instanceof SyntaxError) {
        error.message = `Failed to parse ${packagePath}: ${error.message}`;
        throw error;
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
};

const getPathValue = (value, propertyPath) => {
  const parts = propertyPath.split('.');
  let current = value;

  for (const part of parts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
};

const findGroupedProperty = (pkg, properties) => {
  for (const property of properties) {
    const value = getPathValue(pkg, property);
    if (value !== undefined) {
      return { property, value };
    }
  }

  return null;
};

const getInfo = async (props, dir, result) => {
  if (!Array.isArray(props)) {
    throw new Error('First argument must be array of properties to retrieve.');
  }

  if (props.length === 0) {
    return result;
  }

  const foundPackage = await readPackageUp(dir);
  if (!foundPackage || !foundPackage.path) {
    const missingList = props.map((prop) => JSON.stringify(prop)).join(', ');
    const error = new Error(`Unable to find all properties in parent package.json files. Missing props: ${missingList}`);
    error.missingProps = props;
    error.result = result;
    throw error;
  }

  const { path: src, pkg } = foundPackage;
  const nextProps = [];

  for (const prop of props) {
    if (Array.isArray(prop)) {
      const match = findGroupedProperty(pkg, prop);
      if (match) {
        for (const groupedProp of prop) {
          result.values[groupedProp] = match.value;
          result.source[groupedProp] = { src, pkg, prop: match.property };
        }
      } else {
        nextProps.push(prop);
      }
      continue;
    }

    const value = getPathValue(pkg, prop);
    if (value !== undefined) {
      result.values[prop] = value;
      result.source[prop] = { src, pkg, prop };
    } else {
      nextProps.push(prop);
    }
  }

  if (nextProps.length > 0) {
    return getInfo(nextProps, path.join(path.dirname(src), '..'), result);
  }

  return result;
};

module.exports = (props, dir, cb) => {
  const promise = getInfo(props, dir, { values: {}, source: {} });
  if (typeof cb === 'function') {
    promise.then((result) => cb(null, result), cb);
  }

  return promise;
};
