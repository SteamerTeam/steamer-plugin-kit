'use strict';

const SteamerPlugin = require('steamer-plugin'),
    path = require('path'),
    url = require('url'),
    ora = require('ora'),
    inquirer = require('inquirer'),
    _ = require('lodash'),
    git = require('simple-git'),
    compareVer = require('compare-versions'),
    spawnSync = require('child_process').spawnSync;

/**
 * // .steamer/steamer.plugin-kit.js
     module.exports = {
        'plugin': 'steamer-plugin-kit',
        'config': {
            'kit': 'steamer-react'
        }
    }
*/

class KitPlugin extends SteamerPlugin {
    constructor(args) {
        super(args);
        this.argv = args;
        this.pluginName = 'steamer-plugin-kit';
        this.description = 'manage starterkits';
        // this.globalNodeModules = this.getGlobalModules();

        this.prefix = 'steamer-';
        this.kitHomePath = path.join(this.getGlobalHome(), '.steamer', 'starterkits');
        this.kitOptionsPath = path.join(this.kitHomePath, 'starterkits.js');
        this.spinner = ora('Loading unicorns');
        this.kitOptions = this.getKitOptions();

        this.pkgJson = {};
        // 旧的项目pkgjson内容，在脚手架更新的时候有用。
        this.oldPkgJson = {};
    }

    init(argv) {
        let argvs = argv || this.argv, // command argv
            isAdd = argvs.add,
            isTag = argvs.tag,
            isUpgrade = argvs.upgrade,
            isAlias = argvs.alias || null,
            isGlobal = argvs.global || argvs.g,
            isRemove = argvs.remove,
            isList = argvs.list || argvs.l;

        // this.clone('https://github.com/steamerjs/steamer-simple.git');
        // this.clone()

        if (isAdd) {
            this.add(isAdd, isTag, isAlias);
        }
        else if (isUpgrade) {
            this.upgrade(isUpgrade, isGlobal);
        }
        else if (isRemove) {
            this.remove(isRemove);
        }
        else if (isList) {
            this.list();
        }
        else {
            this.list()
        }
    }

    add(repo, tag, alias) {
        this.clone(repo, tag, alias).then(() => {
            // console.log(this.kitOptions)
            this.writeKitOptions(this.kitOptions);
        }).catch((e) => {
            this.error(e.stack);
        });
    }

    clone(repo, tag = null, alias) {
        let nameSpace = this.getNameSpace(repo),
            kitName = alias || this.getKitName(nameSpace),
            localPath = path.join(this.kitHomePath , kitName);

        let opt = {
            repo,
            kitName,
            localPath,
            tag,
        };

        // starterkit exist and not add another version
        if (!this.kitOptions.list.hasOwnProperty(kitName) && !tag) {
            this.error(`${kitName} exists. Please change the name useing --alias.`);
        }
        else {
            if (!this.kitOptions.list.hasOwnProperty(kitName)) {
                this.kitOptions.list[kitName] = {
                    url: repo,
                    path: localPath,
                    versions: []
                };
            }
            if (opt.tag) {
                return this.cloneTag(opt)
            }
            else {
                return this.cloneLatest(opt);
            }
        }
    }

    cloneLatest(options) {
        let {
            repo,
            kitName,
            localPath,
        } = options;

        return new Promise((resolve, reject) => {
            git()
                .silent(true)
                .exec(() => {
                    this.spinner.start();
                    this.spinner.color = 'cyan';
                    this.spinner.text = `installing ${kitName}`;
                })
                .clone(repo, localPath, '--depth=1', (err) => {
                    err && this.spinFail(kitName, err);
                })
                .exec(() => {
                    let pkgJson = this.getPkgJson(localPath);
                    this.kitOptions.list[kitName] = this._.merge({}, this.kitOptions.list[kitName], {
                        description: pkgJson.description,
                        currentVersion: pkgJson.version,
                        latestVersion: pkgJson.version,
                        versions: [
                            pkgJson.version
                        ]
                    });
                    git(localPath)
                        .silent(true)
                        .branch([pkgJson.version], (err) => {
                            err && this.spinFail(kitName, err)
                        })
                        .checkout(pkgJson.version, (err) => {
                            if (err) {
                                this.spinFail(kitName, err);
                            }
                            else {
                                this.spinSuccess(kitName, pkgJson.version);
                            }
                        })
                        .branch(['-D', 'master'], (err) => {
                            resolve();
                        });
                });
        });
    }

    // fetch specific tag https://stackoverflow.com/questions/45338495/fetch-a-single-tag-from-remote-repository
    // git branch new_branch tag_name
    cloneTag(options) {
        let {
            repo,
            kitName,
            localPath,
            tag
        } = options;

        this.fs.ensureDirSync(localPath); 

        return new Promise((resolve, reject) => {
            git(localPath)
                .silent(true)
                .exec(() => {
                    this.spinner.start();
                    this.spinner.color = 'cyan';
                    this.spinner.text = `installing ${kitName}`;
                })
                .exec(() => {
                    let isGitFolderExists = this.fs.existsSync(path.join(localPath, '.git'));
                    
                    if (!isGitFolderExists) {
                        spawnSync('git', ['init'], { cwd: localPath });
                        spawnSync('git', ['remote', 'add', 'origin', repo], { cwd: localPath });
                    }
                })
                .fetch(['origin', `refs/tags/${tag}:refs/tags/${tag}`], (err) => {
                    if (err) {
                        return this.spinFail(kitName, err);
                    }
                    let version = this.getVersion(tag);
                    git(localPath)
                        .silent(true)
                        .branch([`${version}`, `${tag}`], (err) => {
                            err && this.spinFail(kitName, err);
                        })
                        .checkout(`${version}`, () => {
                            this.spinSuccess(kitName, version);
                            let pkgJson = this.getPkgJson(localPath),
                                versions = this.addVersion(this.kitOptions.list[kitName].versions, pkgJson.version);
        
                            this.kitOptions.list[kitName] = this._.merge({}, this.kitOptions.list[kitName], {
                                description: pkgJson.description,
                                currentVersion: pkgJson.version,
                                latestVersion: versions[0],
                                versions: versions
                            });
                            resolve();
                        });  
                })
            });
    }

    upgrade(kit) {
        if (kit) {
            this.upgradeGlobal(kit).then((newVer) => {
                if (newVer) {
                    this.kitOptions.list[kit].versions = this.addVersion(this.kitOptions.list[kit].versions, newVer);
                    this.kitOptions.list[kit].currentVersion = newVer;
                    this.kitOptions.list[kit].latestVersion = newVer;
                    this.writeKitOptions(this.kitOptions);
                }
            }).catch((e) => {
                this.error(e.stack);
            });
        }
    }

    upgradeGlobal(kitName) {
        let kits = this.kitOptions.list;
        
        if (!kits.hasOwnProperty(kitName)) {
            return this.error(`The starterkit ${kitName} does not exist.`);
        }

        let kitOptions = kits[kitName];

        return new Promise((resolve, reject) => {
            git(kitOptions.path)
                .silent(true)
                .exec(() => {
                    this.spinner.start();
                    this.spinner.color = 'cyan';
                    this.spinner.text = `updating ${kitName}`;
                })
                .fetch(['origin', 'master:master'], (err) => {
                    err && this.spinFail(kitName, err);
                })
                .checkout('master')
                .exec(() => {
                    let curKitOptions = require(path.join(this.kitHomePath, kitName, 'package.json')),
                        oldVer = kitOptions.latestVersion,
                        newVer = curKitOptions.version;
                    
                    if (compareVer(newVer, oldVer) > 0) {
                        git(kitOptions.path)
                            .silent(true)
                            .branch([newVer, 'master'], (err) => {
                                err && this.spinFail(kitName, err);
                            })
                            .checkout(newVer, (err) => {
                                err && this.spinFail(kitName, err);
                            })
                            .branch(['-D', 'master'], () => {
                                this.spinSuccess(kitName, newVer);
                                resolve(newVer);
                            });
                    }
                    else {
                        git(kitOptions.path)
                            .silent(true)
                            .checkout(newVer, (err) => {
                                err && this.spinFail(kitName, err);
                            })
                            .branch(['-D', 'master'], () => {
                                this.spinSuccess(kitName, newVer);
                                resolve();
                            });
                    }
                });
        });
    }

    remove(kit) {
        let kits = this.kitOptions.list;

        if (!kits.hasOwnProperty(kit)) {
            return this.error(`The starterkit ${kit} does not exist.`);
        }
        
        this.fs.removeSync(this.kitOptions.list[kit].path);
        delete this.kitOptions.list[kit];
        this.writeKitOptions(this.kitOptions);
        this.success(`The kit ${kit} is removed.`);
    }

    getKitOptions() {
        
        if (!this.fs.existsSync(this.kitOptionsPath)) {
            let options = {
                list: {},
                timestamp: Date.now()
            };
            this.fs.ensureFileSync(this.kitOptionsPath);
            this.fs.writeFileSync(this.kitOptionsPath, `module.exports = ${JSON.stringify(options, null, 4)};`, 'utf-8');
        }

        return require(this.kitOptionsPath);
    }

    writeKitOptions(options, key) {
        try {
            let updatedOptions = this.getKitOptions();
            
            if (key) {
                updatedOptions.list[key] = options.list[key];
            }
            
            updatedOptions.timestamp = Date.now();
            this.fs.writeFileSync(this.kitOptionsPath, `module.exports = ${JSON.stringify(updatedOptions, null, 4)};`, 'utf-8');
    
        }
        catch (e) {
            this.error(e.stack);
        }
    }
    
    addVersion(oldVers, newVer) {
        for (let i = 0, len = oldVers.length; i < len; i++) {
            if (compareVer(newVer, oldVers[i]) > 0) {
                oldVers.unshift(newVer);
                return oldVers;
            }
        }

        oldVers.push(newVer);
        return oldVers;
    }

    getPkgJson(localPath) {
        let pkgJsonPath = path.join(localPath, 'package.json');
        if (this.fs.existsSync(pkgJsonPath)) {
            return require(pkgJsonPath);
        }
        else {
            throw new Error('package.json does not exist');
        }
    }

    getNameSpace(repo) {
        let localPath = '';
        if (repo.indexOf('http') >= 0) {
            repo = url.parse(repo);
            if (!repo.host) {
                return this.error('Please input correct repo url');
            }
            localPath = `${repo.host}${repo.pathname.replace('.git', '')}`;
        }
        else if (repo.indexOf('git@') === 0) {
            localPath = repo.replace('git@', '').replace('.git', '').replace(':', '/');
        }
        else if (typeof this.kitOptions.list[repo] !== 'undefined') {
            localPath = this.getNameSpace(this.kitOptions.list[repo].url);
        }

        return localPath;
    }

    getKitName(ns) {
        let kit = null;
        if (ns.split('/').length === 3) {
            kit = ns.split('/')[2];
        }
        return kit;
    }

    getVersion(tag) {
        return tag.replace(/[a-zA-Z]+/ig, '');
    }

    spinSuccess(kitName, version) {
        this.spinner.stop().succeed([
            `${kitName}@${version} installed`
        ]);
    }

    spinFail(kitName, err) {
        this.spinner.stop().fail([
            `${kitName} ${err}`
        ]);
    }

    list() {
        let kits = this.kitOptions.list;
        Object.keys(kits).forEach((key) => {
            let kit = kits[key];
            this.warn(this.chalk.bold(`* ${key}@${kit.currentVersion}`));
            this.log(`    - des: ${kit.description}`);
            this.log(`    - url: ${kit.url}`);
        });
    }

    install(kits) {
        kits.forEach((item) => {
            console.log(item);
        });
    }

    /**
     * [help]
     */
    help() {
        this.printUsage('steamer kit manager', 'kit');
        this.printOption([
            // {
            //     option: 'list',
            //     alias: 'l',
            //     description: 'list all available starter kits'
            // },
            // {
            //     option: 'install',
            //     alias: 'i',
            //     value: '<starter kit> [--path|-p] <project path>',
            //     description: 'install starter kit'
            // },
            // {
            //     option: 'update',
            //     alias: 'u',
            //     value: '[<starter kit>]',
            //     description: 'update starter kit for project'
            // }
        ]);
    }
}

module.exports = KitPlugin;