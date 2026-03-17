use serde::{Deserialize, Serialize};

use super::agents::{load_agents_files, ContextFile};
use super::skills::{load_skills, Skill};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Context {
    pub cwd: String,
    pub agents_files: Vec<ContextFile>,
    pub skills: Vec<Skill>,
    pub skill_warnings: Vec<(String, String)>,
}

impl Context {
    pub fn load(cwd: String) -> Self {
        let agents_files = load_agents_files(Some(&cwd));
        let skills_result = load_skills(Some(&cwd));
        Self {
            cwd,
            agents_files,
            skills: skills_result.skills,
            skill_warnings: skills_result
                .warnings
                .into_iter()
                .map(|w| (w.skill_path, w.message))
                .collect(),
        }
    }

    pub fn reload(&mut self) {
        let c = Self::load(self.cwd.clone());
        *self = c;
    }
}
