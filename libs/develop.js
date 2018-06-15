/**
 * develop.js
 *
 * any util function for startkit development
 */

const path = require('path');
const { help, delRequireCache } = require('../utils/kit');

/**
 * develop starterkit and make it on starterkit list
 * @param {String} kitNameParam starterkit name
 */
module.exports = function(kitNameParam = null) {
    if (Array.isArray(kitNameParam)) {
        return help.bind(this)();
    }
    let kitHomePath = this.kitHomePath;
    let kitOptions = this.kitOptions;
    let curPath = process.cwd();
    let packageJsonPath = path.join(curPath, 'package.json');

    delRequireCache.bind(this)(packageJsonPath);
    let packageJson = require(packageJsonPath);
    let kitName =
        kitNameParam && kitNameParam !== true ? kitNameParam : packageJson.name;
    let linkPath = path.join(kitHomePath, kitName);
    let ver = packageJson.version;

    if (this.fs.pathExistsSync(linkPath)) {
        if (this.fs.lstatSync(linkPath).isSymbolicLink()) {
            this.fs.unlinkSync(linkPath);
        } else {
            return this.error(
                `${kitName} exists. Please change the name useing --alias.`
            );
        }
    }

    this.git()
        .silent(true)
        .branch([ver], err => {
            let errMsg = `already exists.`;
            if (err.includes(errMsg)) {
                this.fs.symlinkSync(
                    path.join(curPath),
                    path.join(kitHomePath, kitName)
                );

                // init starterkit config
                kitOptions.list[kitName] = {
                    url: null,
                    path: linkPath,
                    description: packageJson.description,
                    versions: [ver],
                    currentVersion: ver,
                    latestVersion: ver
                };

                this.writeKitOptions(kitOptions);

                this.success(`${kitName}@${ver} installed.`);
            } else {
                this.error(err);
            }
        });
};
