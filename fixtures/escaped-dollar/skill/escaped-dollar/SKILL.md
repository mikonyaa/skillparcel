---
name: escaped-dollar
description: Original synthetic SkillParcel fixture
disable-model-invocation: true
---
<!-- SP_escaped-dollar_BEGIN -->
Formula =B5*(1+$B\$6)
awk '{print \$1}'
Literal \$6
<!-- SP_escaped-dollar_END -->
