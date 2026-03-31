#!/usr/bin/env node
import { program } from 'commander'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { registerValidate } from './commands/validate'
import { registerBuild } from './commands/build'
import { registerLink } from './commands/link'
import { registerDev } from './commands/dev'
import { registerPublish } from './commands/publish'
import { registerDoctor } from './commands/doctor'
import { registerAttach } from './commands/attach'
import { registerDetach } from './commands/detach'


const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf-8'))

program
  .name('asyar')
  .description('Asyar Extension Developer CLI')
  .version(pkg.version)

registerValidate(program)
registerBuild(program)
registerLink(program)
registerDev(program)
registerPublish(program)
registerDoctor(program)
registerAttach(program)
registerDetach(program)


program.parse(process.argv)
