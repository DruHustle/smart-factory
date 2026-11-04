#!/usr/bin/env python3
"""Materialize complete component quality workflows at the monorepo root.

Nested files remain compatibility templates for the old manual tooling. This
module changes layout, never test commands, production targets or permissions.
"""
import argparse
from copy import deepcopy
from pathlib import Path
import re
import yaml

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = 'smart-factory-frontend'
OUTPUTS = {
    'ci.yml': 'frontend-quality.yml',
    'documentation-artifacts.yml': 'documentation-artifacts.yml',
    'renderer-quality.yml': 'renderer-quality.yml',
}
CROSS_SERVICE = {'trusted-cross-service', 'aas-cross-service'}

class WorkflowLoader(yaml.SafeLoader):
    pass

WorkflowLoader.yaml_implicit_resolvers = deepcopy(yaml.SafeLoader.yaml_implicit_resolvers)
for key, resolvers in WorkflowLoader.yaml_implicit_resolvers.items():
    WorkflowLoader.yaml_implicit_resolvers[key] = [(tag, pattern) for tag, pattern in resolvers
                                                  if tag != 'tag:yaml.org,2002:bool']
WorkflowLoader.add_implicit_resolver('tag:yaml.org,2002:bool', re.compile(r'^(?:true|false)$', re.I), list('tTfF'))

def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError('Duplicate workflow key: ' + str(key))
        result[key] = loader.construct_object(value_node, deep=deep)
    return result

WorkflowLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)

class WorkflowDumper(yaml.SafeDumper):
    pass

def string_representation(dumper, data):
    return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|' if '\n' in data else None)

WorkflowDumper.add_representer(str, string_representation)

def load(text):
    value = yaml.load(text, Loader=WorkflowLoader)
    if not isinstance(value, dict) or not isinstance(value.get('jobs'), dict) or 'on' not in value:
        raise ValueError('Expected a complete Actions workflow')
    return value

def prefixed(path):
    if path.startswith(('/', '$', '~', FRONTEND + '/')):
        return path
    negated = path.startswith('!')
    return ('!' if negated else '') + FRONTEND + '/' + path.lstrip('!')

def migrate(original):
    data = deepcopy(original)
    data['name'] = 'Factory ' + data['name']
    # Every canonical main revision must have complete release evidence.
    data['on']['push'] = {'branches': ['main']}
    data['defaults'] = {'run': {'working-directory': FRONTEND, 'shell': 'bash'}}
    for event in data['on'].values():
        if isinstance(event, dict) and 'paths' in event:
            event['paths'] = [prefixed(path) for path in event['paths']]
            event['paths'] += ['.github/workflows/**', 'scripts/consolidate_workflows.py']
    for job_id, job in data['jobs'].items():
        if 'uses' in job:
            raise ValueError('Reusable workflows require explicit migration')
        cross_service = job_id in CROSS_SERVICE
        has_checkout = any(step.get('uses', '').startswith('actions/checkout@')
                           for step in job.get('steps', []))
        if cross_service or not has_checkout:
            job['defaults'] = {'run': {'working-directory': '.', 'shell': 'bash'}}
        steps = []
        removed = []
        for original_step in job.get('steps', []):
            step = deepcopy(original_step)
            action = step.get('uses', '').split('@')[0]
            if cross_service and step.get('name') == 'Read immutable companion identities':
                removed.append('identity-reader')
                continue
            if action == 'actions/checkout':
                options = step.setdefault('with', {})
                repository = options.get('repository')
                if repository:
                    if cross_service and repository in ('DruHustle/smart-factory-backend', 'DruHustle/smart-factory-edge'):
                        removed.append(repository)
                        continue
                    raise ValueError('Unexpected external source checkout: ' + repository)
                options.pop('path', None)
                options['persist-credentials'] = False
                options['ref'] = '${{ github.event.pull_request.head.sha || github.sha }}'
            elif action == 'actions/setup-node' and step.get('with', {}).get('cache') == 'pnpm':
                step['with']['cache-dependency-path'] = FRONTEND + '/pnpm-lock.yaml'
            elif action == 'pnpm/action-setup':
                step.setdefault('with', {})['package_json_file'] = FRONTEND + '/package.json'
            elif action == 'actions/upload-artifact':
                options = step.setdefault('with', {})
                paths = options.get('path', '')
                if not cross_service:
                    options['path'] = '\n'.join(prefixed(path) for path in paths.splitlines()) + ('\n' if '\n' in paths else '')
            steps.append(step)
        if cross_service and sorted(removed) != sorted(['identity-reader', 'DruHustle/smart-factory-backend', 'DruHustle/smart-factory-edge']):
            raise ValueError('Companion checkout layout changed: ' + job_id)
        job['steps'] = steps
    validate(original, data)
    return data

def validate(original, changed):
    if set(original['jobs']) != set(changed['jobs']):
        raise ValueError('The migration must preserve every quality job')
    for job_id, before in original['jobs'].items():
        after = changed['jobs'][job_id]
        expected = [s['run'] for s in before.get('steps', []) if 'run' in s and not
                    (job_id in CROSS_SERVICE and s.get('name') == 'Read immutable companion identities')]
        actual = [s['run'] for s in after.get('steps', []) if 'run' in s]
        if expected != actual:
            raise ValueError('Test commands were removed or changed: ' + job_id)
        for key in ('needs', 'if', 'strategy', 'services', 'permissions', 'timeout-minutes', 'env'):
            if before.get(key) != after.get(key):
                raise ValueError('Changed job behavior: ' + job_id + '/' + key)
        for step in after.get('steps', []):
            if step.get('uses', '').startswith('actions/checkout@') and step['with'].get('repository'):
                raise ValueError('Consolidated validation must not check out a legacy repository')
    if original.get('permissions') != changed.get('permissions'):
        raise ValueError('Workflow permissions changed')

def generated(root=ROOT):
    result = {}
    for source, target in OUTPUTS.items():
        original = load((root / FRONTEND / '.github/workflows' / source).read_text())
        result['.github/workflows/' + target] = (
            '# Generated by scripts/consolidate_workflows.py; run --write after changing a compatibility template.\n'
            + yaml.dump(migrate(original), Dumper=WorkflowDumper, sort_keys=False, width=120)
        )
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--write', action='store_true')
    args = parser.parse_args()
    stale = []
    for relative, content in generated().items():
        path = ROOT / relative
        if args.write:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        elif not path.is_file() or path.read_text() != content:
            stale.append(relative)
    if stale:
        raise SystemExit('Stale consolidated workflows: ' + ', '.join(stale))
    print('All component quality jobs and their test commands retained; consolidated workflow layout verified.')

if __name__ == '__main__':
    main()
